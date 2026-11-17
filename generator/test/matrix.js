/** Settings the tests run through: every option on at least once. */
export const MATRIX = {
  default: {},
  develop: {channel: 'develop'},
  everything: {
    channel: 'develop', lending: true, ocr: true, search: 'bundled', extraction: true,
    assistant: 'bundled', mail: 'catcher', backup: true, telemetry: 'bundled',
  },
  external: {
    database: 'external', redis: 'external', channel: 'develop', search: 'external',
    assistant: 'external', mail: 'smtp', smtpUser: 'library', telemetry: 'external', portal: false,
  },
  k8s: {target: 'k8s', channel: 'develop', lending: true, extraction: true, storageClass: 'longhorn'},
  docker: {target: 'docker'},
};
