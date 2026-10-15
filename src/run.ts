import * as core from '@actions/core'

import {kubeconformLint} from './kubeconform/kubeconform.js'
import {kubectlLint} from './kubectl/kubectl.js'
import {expandManifestInputs} from './manifests.js'

export async function kubeconform() {
   // get inputs
   const type = core.getInput('lintType', {required: true})
   const manifestsInput = core.getInput('manifests', {required: true})
   const workspace = process.env['GITHUB_WORKSPACE'] || process.cwd()
   const manifests = await expandManifestInputs(
      manifestsInput.split(/\r?\n/),
      workspace
   )

   if (type.toLocaleLowerCase() === 'dryrun') {
      const namespace =
         core.getInput('namespace', {required: false}) || 'default'
      await kubectlLint(manifests, namespace)
   } else {
      const kubeconformOpts =
         core.getInput('kubeconformOpts', {required: false}) || '-summary'
      await kubeconformLint(manifests, kubeconformOpts)
   }
}
