import * as path from 'node:path'
import {lstatSync, readdirSync, realpathSync, type Stats} from 'node:fs'
import {glob} from 'node:fs/promises'

export interface ManifestLimits {
   maxDepth: number
   maxEntries: number
   maxFileSize: number
   maxTotalSize: number
}

export const DEFAULT_MANIFEST_LIMITS: ManifestLimits = {
   maxDepth: 20,
   maxEntries: 1000,
   maxFileSize: 10 * 1024 * 1024,
   maxTotalSize: 100 * 1024 * 1024
}

const MANIFEST_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules'])
const GLOB_CHARACTERS = /[*?[\]{}]/
const UNSAFE_GLOB_SYNTAX = /[{}()!]/
const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/

interface ExpansionState {
   workspace: string
   limits: ManifestLimits
   entries: number
   totalSize: number
   files: string[]
   seen: Set<string>
}

function isOutsideWorkspace(workspace: string, candidate: string): boolean {
   const relative = path.relative(workspace, candidate)
   return (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
   )
}

function assertWorkspacePath(workspace: string, candidate: string): void {
   if (isOutsideWorkspace(workspace, candidate)) {
      throw new Error(
         `Manifest path escapes GITHUB_WORKSPACE: ${path.relative(workspace, candidate)}`
      )
   }
}

function assertRelativeInput(input: string, workspace: string): void {
   if (
      path.isAbsolute(input) ||
      path.win32.isAbsolute(input) ||
      PARENT_SEGMENT.test(input)
   ) {
      throw new Error(`Manifest input must be workspace-relative: ${input}`)
   }

   assertWorkspacePath(workspace, path.resolve(workspace, input))
}

function readEntry(candidate: string, state: ExpansionState): Stats {
   state.entries++
   if (state.entries > state.limits.maxEntries) {
      throw new Error(
         `Manifest expansion exceeded ${state.limits.maxEntries} filesystem entries`
      )
   }

   try {
      return lstatSync(candidate)
   } catch {
      throw new Error(
         `Manifest path does not exist: ${path.relative(state.workspace, candidate)}`
      )
   }
}

function addManifest(
   candidate: string,
   stats: Stats,
   state: ExpansionState
): boolean {
   const extension = path.extname(candidate).toLowerCase()
   if (!MANIFEST_EXTENSIONS.has(extension)) return false

   if (stats.size > state.limits.maxFileSize) {
      throw new Error(
         `Manifest exceeds the ${state.limits.maxFileSize} byte file-size limit: ${path.relative(state.workspace, candidate)}`
      )
   }

   const canonical = realpathSync(candidate)
   assertWorkspacePath(state.workspace, canonical)
   if (state.seen.has(canonical)) return true

   const nextTotal = state.totalSize + stats.size
   if (nextTotal > state.limits.maxTotalSize) {
      throw new Error(
         `Manifest expansion exceeded the ${state.limits.maxTotalSize} byte total-size limit`
      )
   }

   state.seen.add(canonical)
   state.totalSize = nextTotal
   state.files.push(canonical)
   return true
}

function inspectPath(
   candidate: string,
   depth: number,
   state: ExpansionState
): boolean {
   if (depth > state.limits.maxDepth) {
      throw new Error(
         `Manifest expansion exceeded the maximum depth of ${state.limits.maxDepth}`
      )
   }

   const stats = readEntry(candidate, state)
   const displayPath = path.relative(state.workspace, candidate)

   if (stats.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed: ${displayPath}`)
   }

   const canonical = realpathSync(candidate)
   assertWorkspacePath(state.workspace, canonical)

   if (stats.isDirectory()) {
      let foundManifest = false
      for (const entry of readdirSync(canonical).sort()) {
         if (EXCLUDED_DIRECTORIES.has(entry)) continue
         foundManifest =
            inspectPath(path.join(canonical, entry), depth + 1, state) ||
            foundManifest
      }
      return foundManifest
   }

   if (!stats.isFile()) {
      throw new Error(`Only regular manifest files are allowed: ${displayPath}`)
   }

   return addManifest(canonical, stats, state)
}

export async function expandManifestInputs(
   inputs: string[],
   workspacePath: string,
   limits: ManifestLimits = DEFAULT_MANIFEST_LIMITS
): Promise<string[]> {
   const workspaceStats = lstatSync(workspacePath)
   if (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory()) {
      throw new Error('GITHUB_WORKSPACE must be a regular directory')
   }

   const workspace = realpathSync(workspacePath)
   const state: ExpansionState = {
      workspace,
      limits,
      entries: 0,
      totalSize: 0,
      files: [],
      seen: new Set()
   }

   for (const rawInput of inputs) {
      const input = rawInput.trim()
      if (!input) continue

      assertRelativeInput(input, workspace)
      let foundManifest = false

      if (GLOB_CHARACTERS.test(input)) {
         if (UNSAFE_GLOB_SYNTAX.test(input)) {
            throw new Error(
               `Manifest glob uses unsupported expansion syntax: ${input}`
            )
         }

         const matches: string[] = []
         for await (const match of glob(input, {
            cwd: workspace,
            exclude: [
               '.git/**',
               '**/.git/**',
               'node_modules/**',
               '**/node_modules/**'
            ]
         })) {
            matches.push(match)
            if (matches.length > limits.maxEntries) {
               throw new Error(
                  `Manifest glob exceeded ${limits.maxEntries} matches: ${input}`
               )
            }
         }

         if (matches.length === 0) {
            throw new Error(`Manifest glob matched no paths: ${input}`)
         }

         for (const match of matches.sort()) {
            const resolvedMatch = path.resolve(workspace, match)
            assertWorkspacePath(workspace, resolvedMatch)
            foundManifest =
               inspectPath(resolvedMatch, 0, state) || foundManifest
         }
      } else {
         foundManifest = inspectPath(path.resolve(workspace, input), 0, state)
      }

      if (!foundManifest) {
         throw new Error(`Manifest input contains no supported files: ${input}`)
      }
   }

   if (state.files.length === 0) {
      throw new Error('No manifest files were provided')
   }

   return state.files
}
