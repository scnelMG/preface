export default function ShareLayout({ children }: LayoutProps<'/'>) {
  // 공유받은 시안 보기(S15P31B204-575). 받은 사람은 회원이 아닐 수 있어 헤더·푸터·로그인 없이 뷰어만 둔다.
  return <main className="preface-app flex flex-1 flex-col">{children}</main>
}
