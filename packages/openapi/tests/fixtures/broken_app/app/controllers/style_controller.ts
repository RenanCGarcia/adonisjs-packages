export default class StyleController {
  async untagged() {
    return { ok: true }
  }

  /**
   * Return a summary far longer than the rule allows.
   *
   * @tags Styling
   */
  async wordy() {
    return { ok: true }
  }
}
