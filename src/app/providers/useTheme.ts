import { useContext } from 'react'

import { ThemeContext, type ThemeState } from './themeContext'

export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}
