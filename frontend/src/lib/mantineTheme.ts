import { createTheme } from '@mantine/core'

/**
 * Mantine 主题：颜色阶与字体全部走现有设计令牌，主色使用近黑的 ink。
 * 浅色主题主按钮取 ink[9]（深墨），深色主题取 ink[0]（浅色），配合 autoContrast 自动反色。
 */
export const mantineTheme = createTheme({
  primaryColor: 'ink',
  primaryShade: { light: 9, dark: 0 },
  autoContrast: true,
  fontFamily: 'var(--sans)',
  fontFamilyMonospace: 'var(--mono)',
  headings: { fontFamily: 'var(--display)' },
  fontSizes: { xs: '12px', sm: '13px', md: '13.5px', lg: '14.5px', xl: '16px' },
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '18px' },
  defaultRadius: 'md',
  colors: {
    ink: ['#E4EAF5', '#D5DCEA', '#B9C4D8', '#9AA9C2', '#7C8DA6', '#5F7089', '#47566D', '#2F3D52', '#1B2434', '#0E1524'],
    accent: ['#EAF3ED', '#D3E7DB', '#B5D6C5', '#8FC0A5', '#69A885', '#4A8F6B', '#357A57', '#277452', '#1D5A3F', '#16452F'],
    risk: ['#FBF3E4', '#F3E2C4', '#E8CB97', '#DCB06A', '#CF9540', '#C58228', '#B7791F', '#9A6418', '#7B4F13', '#5C3B0E'],
  },
})
