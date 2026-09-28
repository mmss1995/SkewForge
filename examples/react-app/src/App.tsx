import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { UpdateBanner, useSkew } from '@skewforge/react'

// Each route is its own chunk. A release changes their hashes, which is exactly what breaks
// open tabs behind a plain static server.
const Catalog = lazy(() => import('./routes/Catalog'))
const Product = lazy(() => import('./routes/Product'))
const Checkout = lazy(() => import('./routes/Checkout'))

function DeploymentBadge() {
  const { running, current, connection } = useSkew()
  return (
    <p className="badge" data-testid="badge">
      running <code>{running ?? 'dev'}</code>
      {current && current !== running && (
        <>
          {' '}
          · live <code>{current}</code>
        </>
      )}{' '}
      · <span className={`dot dot-${connection}`} /> {connection}
    </p>
  )
}

export function App() {
  return (
    <div className="shell">
      <UpdateBanner className="update-banner" message="A new version of the shop is live — it loads on your next click." actionLabel="Update now" />
      <header>
        <h1>Skew Shop</h1>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/catalog">Catalog</NavLink>
          <NavLink to="/product/42">Product</NavLink>
          <NavLink to="/checkout">Checkout</NavLink>
        </nav>
        <DeploymentBadge />
      </header>
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Routes>
            <Route index element={<Home />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="product/:id" element={<Product />} />
            <Route path="checkout" element={<Checkout />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function Home() {
  return (
    <section>
      <h2>Try to break it</h2>
      <ol>
        <li>Open this page, then deploy a new release in another terminal.</li>
        <li>Without reloading, click a link you have not opened yet.</li>
        <li>Behind a plain static server that click fails with “Failed to fetch dynamically imported module”. Behind SkewForge it just works.</li>
      </ol>
    </section>
  )
}
