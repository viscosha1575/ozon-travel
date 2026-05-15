function App() {
  return (
    <main className="split-screen" aria-label="Three-row fullscreen layout">
      <div className="background-vectors" aria-hidden="true">
        <img src="/intro/vectors/left-up.svg" alt="" className="background-vector background-vector-left" />
        <img src="/intro/vectors/right-up.svg" alt="" className="background-vector background-vector-right" />
        <img src="/intro/vectors/center-down.svg" alt="" className="background-vector background-vector-center" />
      </div>
      <section className="logo-panel" aria-label="Logo area">
        <img
          src="/intro/logo.png"
          alt="Logo"
          className="logo-image"
        />
      </section>
      <section className="spacer-panel" aria-hidden="true" />
      <div className="content-bag-layer" aria-hidden="true">
        <img
          src="/intro/bags/pink-bag.png"
          alt=""
          className="content-bag-accent content-bag-accent-left"
        />
        <img
          src="/intro/bags/green-bag.png"
          alt=""
          className="content-bag-accent content-bag-accent-right"
        />
        <img
          src="/intro/bags/colorful-bag.png"
          alt=""
          className="content-bag"
        />
      </div>
      <section className="content-panel" aria-label="Content area">
        <div className="content-panel-inner">
          <div className="content-copy">
            <p className="content-kicker">
              <span className="content-line">Ловите ваш багаж!</span>
            </p>
            <h1 className="content-title">
              <span className="content-line">Промокоды</span>
              <span className="content-line">на путешествия и шоппинг</span>
              <span className="content-line">
                до <span className="content-accent">100 000 ₽</span> на Ozon
              </span>
            </h1>
            <p className="content-description">
              <span className="content-line">Крутите каждый день, приглашайте друзей</span>
              <span className="content-line">и получайте больше попыток</span>
            </p>
          </div>

          <button type="button" className="content-action">
            Начать
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
