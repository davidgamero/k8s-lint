import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

vi.mock('@actions/core')
vi.mock('./kubeconform/kubeconform.js')
vi.mock('./kubectl/kubectl.js')
vi.mock('./manifests.js')

const core = await import('@actions/core')
const kubeconform = await import('./kubeconform/kubeconform.js')
const kubectl = await import('./kubectl/kubectl.js')
const manifests = await import('./manifests.js')
const run = await import('./run.js')

describe('run', () => {
   const originalWorkspace = process.env['GITHUB_WORKSPACE']

   beforeEach(() => {
      vi.clearAllMocks()
      process.env['GITHUB_WORKSPACE'] = '/workspace'
      vi.mocked(manifests.expandManifestInputs).mockResolvedValue([
         '/workspace/manifest1.yaml',
         '/workspace/manifest2.yaml',
         '/workspace/manifest3.yaml'
      ])
   })

   afterEach(() => {
      if (originalWorkspace === undefined) {
         delete process.env['GITHUB_WORKSPACE']
      } else {
         process.env['GITHUB_WORKSPACE'] = originalWorkspace
      }
   })

   test('runs kubectl dry run based on input', async () => {
      vi.mocked(core.getInput).mockImplementation((input) => {
         if (input == 'manifests')
            return 'manifest1.yaml\nmanifest2.yaml\nmanifest3.yaml'
         if (input == 'lintType') return 'dryrun'
         if (input == 'namespace') return 'sampleNamespace'
         return ''
      })

      expect(await run.kubeconform()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledTimes(3)
      expect(kubectl.kubectlLint).toHaveBeenCalledWith(
         [
            '/workspace/manifest1.yaml',
            '/workspace/manifest2.yaml',
            '/workspace/manifest3.yaml'
         ],
         'sampleNamespace'
      )
   })

   test('uses default namespace if input not given', async () => {
      vi.mocked(core.getInput).mockImplementation((input) => {
         if (input == 'manifests')
            return 'manifest1.yaml\nmanifest2.yaml\nmanifest3.yaml'
         if (input == 'lintType') return 'dryrun'
         if (input == 'namespace') return ''
         return ''
      })

      expect(await run.kubeconform()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledTimes(3)
      expect(kubectl.kubectlLint).toHaveBeenCalledWith(
         [
            '/workspace/manifest1.yaml',
            '/workspace/manifest2.yaml',
            '/workspace/manifest3.yaml'
         ],
         'default'
      )
   })

   test('runs kubeconform on manifests based on input', async () => {
      vi.mocked(core.getInput).mockImplementation((input) => {
         if (input == 'manifests')
            return 'manifest1.yaml\nmanifest2.yaml\nmanifest3.yaml'
         if (input == 'lintType') return 'kubeconform'
         if (input == 'kubeconformOpts') return '-summary'
         return ''
      })

      expect(await run.kubeconform()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledTimes(3)
      expect(kubeconform.kubeconformLint).toHaveBeenCalledWith(
         [
            '/workspace/manifest1.yaml',
            '/workspace/manifest2.yaml',
            '/workspace/manifest3.yaml'
         ],
         '-summary'
      )
   })

   test('uses -summary option if input not given', async () => {
      vi.mocked(core.getInput).mockImplementation((input) => {
         if (input == 'manifests')
            return 'manifest1.yaml\nmanifest2.yaml\nmanifest3.yaml'
         if (input == 'lintType') return 'kubeconform'
         if (input == 'kubeconformOpts') return ''
         return ''
      })

      expect(await run.kubeconform()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledTimes(3)
      expect(kubeconform.kubeconformLint).toHaveBeenCalledWith(
         [
            '/workspace/manifest1.yaml',
            '/workspace/manifest2.yaml',
            '/workspace/manifest3.yaml'
         ],
         '-summary'
      )
   })

   test('expands manifest inputs within the workspace', async () => {
      vi.mocked(core.getInput).mockImplementation((input) => {
         if (input == 'manifests') return 'manifests/\nmore/*.yaml'
         if (input == 'lintType') return 'kubeconform'
         if (input == 'kubeconformOpts') return '-summary'
         return ''
      })

      await run.kubeconform()

      expect(manifests.expandManifestInputs).toHaveBeenCalledWith(
         ['manifests/', 'more/*.yaml'],
         '/workspace'
      )
      expect(kubeconform.kubeconformLint).toHaveBeenCalledWith(
         [
            '/workspace/manifest1.yaml',
            '/workspace/manifest2.yaml',
            '/workspace/manifest3.yaml'
         ],
         '-summary'
      )
   })
})
