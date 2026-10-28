import LocalizedException from '#exceptions/localized_exception'

export default class FrozenProbeException extends LocalizedException<'E_PROBE_FROZEN'> {
  static override status = 423
  static override code = 'E_PROBE_FROZEN'
}
