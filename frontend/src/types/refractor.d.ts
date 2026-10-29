declare module 'refractor' {
  export const refractor: {
    highlight: (value: string, language: string) => unknown
    registered: (language: string) => boolean
    register: (syntax: unknown) => void
  }
}
