import { julrPreset } from '@julr/tooling-configs/oxc/fmt'

const preset = julrPreset()

export default {
  ...preset,
  ignorePatterns: [...(preset.ignorePatterns ?? []), '.changeset/*.md', '**/.adonisjs/**'],
}
