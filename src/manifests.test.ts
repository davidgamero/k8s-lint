import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {
   mkdirSync,
   mkdtempSync,
   realpathSync,
   rmSync,
   symlinkSync,
   writeFileSync
} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {expandManifestInputs, type ManifestLimits} from './manifests.js'

describe('expandManifestInputs', () => {
   let workspace: string

   beforeEach(() => {
      workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'k8s-lint-')))
   })

   afterEach(() => {
      rmSync(workspace, {recursive: true, force: true})
   })

   test('expands, filters, orders, and deduplicates real manifest paths', async () => {
      mkdirSync(path.join(workspace, 'manifests', 'nested'), {recursive: true})
      writeFileSync(path.join(workspace, 'manifests', 'deployment.yaml'), 'a')
      writeFileSync(path.join(workspace, 'manifests', 'config.json'), '{}')
      writeFileSync(
         path.join(workspace, 'manifests', 'nested', 'service.yml'),
         'b'
      )
      writeFileSync(path.join(workspace, 'manifests', 'README.md'), 'ignored')

      const result = await expandManifestInputs(
         ['manifests', 'manifests/*.yaml'],
         workspace
      )

      expect(result).toEqual([
         path.join(workspace, 'manifests', 'config.json'),
         path.join(workspace, 'manifests', 'deployment.yaml'),
         path.join(workspace, 'manifests', 'nested', 'service.yml')
      ])
   })

   test('rejects paths outside the workspace and symbolic links', async () => {
      await expect(
         expandManifestInputs(['../outside.yaml'], workspace)
      ).rejects.toThrow('workspace-relative')
      await expect(
         expandManifestInputs(
            [path.join(workspace, 'absolute.yaml')],
            workspace
         )
      ).rejects.toThrow('workspace-relative')
      await expect(
         expandManifestInputs(['C:\\outside\\manifest.yaml'], workspace)
      ).rejects.toThrow('workspace-relative')
      await expect(
         expandManifestInputs(['{/,...}etc/passwd'], workspace)
      ).rejects.toThrow('unsupported expansion syntax')

      if (process.platform !== 'win32') {
         const outside = path.join(path.dirname(workspace), 'outside.yaml')
         writeFileSync(outside, 'secret')
         symlinkSync(outside, path.join(workspace, 'linked.yaml'))
         await expect(
            expandManifestInputs(['linked.yaml'], workspace)
         ).rejects.toThrow('Symbolic links are not allowed')
         rmSync(outside, {force: true})
      }
   })

   test('enforces traversal and size limits', async () => {
      mkdirSync(path.join(workspace, 'one', 'two'), {recursive: true})
      writeFileSync(path.join(workspace, 'one', 'two', 'deep.yaml'), 'a')
      writeFileSync(path.join(workspace, 'large.yaml'), '1234')
      writeFileSync(path.join(workspace, 'first.yaml'), '123')
      writeFileSync(path.join(workspace, 'second.yaml'), '123')

      const baseLimits: ManifestLimits = {
         maxDepth: 20,
         maxEntries: 100,
         maxFileSize: 100,
         maxTotalSize: 100
      }

      await expect(
         expandManifestInputs(['one'], workspace, {
            ...baseLimits,
            maxDepth: 1
         })
      ).rejects.toThrow('maximum depth')
      await expect(
         expandManifestInputs(['large.yaml'], workspace, {
            ...baseLimits,
            maxFileSize: 3
         })
      ).rejects.toThrow('file-size limit')
      await expect(
         expandManifestInputs(['first.yaml', 'second.yaml'], workspace, {
            ...baseLimits,
            maxTotalSize: 5
         })
      ).rejects.toThrow('total-size limit')
      await expect(
         expandManifestInputs(['one'], workspace, {
            ...baseLimits,
            maxEntries: 2
         })
      ).rejects.toThrow('filesystem entries')
   })

   test('fails for unmatched globs and inputs without manifests', async () => {
      mkdirSync(path.join(workspace, 'empty'))
      writeFileSync(path.join(workspace, 'empty', 'README.md'), 'ignored')

      await expect(
         expandManifestInputs(['missing/*.yaml'], workspace)
      ).rejects.toThrow('matched no paths')
      await expect(expandManifestInputs(['empty'], workspace)).rejects.toThrow(
         'contains no supported files'
      )
   })
})
