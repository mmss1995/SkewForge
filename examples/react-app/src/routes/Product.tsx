import { release } from '../release'

export default function Product() {
  return (
    <section data-testid="route">
      <h2>Product</h2>
      <p>
        This chunk was built for release <strong data-testid="release">{release}</strong>.
      </p>
    </section>
  )
}
