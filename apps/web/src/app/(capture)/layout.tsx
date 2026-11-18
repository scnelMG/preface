export default function CaptureLayout({ children }: LayoutProps<'/'>) {
  // 휴대폰 전용 화면이다. 헤더·푸터를 두지 않고 세로 화면에 맞춘다.
  // 업로드 전용 세션(scope=capture)은 허용 API가 좁다 — 벗어나면 AUTH_023이 온다.
  return <main className="preface-app flex flex-1 flex-col">{children}</main>
}
