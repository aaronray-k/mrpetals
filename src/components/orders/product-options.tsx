import { productLabel, type ProductRef } from '~/lib/orders/api'

/** Product <option>s grouped by flower type. */
export function ProductOptions({ products }: { products: ProductRef[] }) {
  const groups = [...new Set(products.map((p) => p.flower_type))]
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {products
            .filter((p) => p.flower_type === g)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {productLabel(p)} ({p.product_code})
              </option>
            ))}
        </optgroup>
      ))}
    </>
  )
}
