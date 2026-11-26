const DATASET_VERSION = /^(.*)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})(?:-[0-9a-f]{8})?$/
const KAMEI_2013_IMPORT = /^kamei-2013-[0-9a-f]{12}-(.+)$/

export function datasetVersionLabel(version: string) {
  const match = DATASET_VERSION.exec(version)
  if (!match) return { name: version, range: null }
  const published = KAMEI_2013_IMPORT.exec(match[1])
  return {
    name: published ? `Kamei 2013 · ${published[1]}` : match[1],
    range: `${match[2]} — ${match[3]}`,
  }
}

export function splitPresetLabel(preset: string) {
  const match = /^temporal-(\d+)-(\d+)-(\d+)$/.exec(preset)
  return match ? `${match[1]} / ${match[2]} / ${match[3]}` : preset
}
