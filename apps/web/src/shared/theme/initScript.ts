/**
 * 화면 밝기 저장 키와 첫 그림용 스크립트. 서버 컴포넌트(layout.tsx)가 문자열로 읽어야 해서
 * 'use client' 파일(theme.ts)과 나눠 둔다.
 */
export const THEME_STORAGE_KEY = 'preface.theme'

/** layout.tsx `<head>`에 그대로 넣는다. 저장된 값이 dark일 때만, 하이드레이션 전에 `data-theme`를 붙인다 */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`
