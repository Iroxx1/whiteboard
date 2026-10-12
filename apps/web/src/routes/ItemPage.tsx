import { useNavigate, useParams } from 'react-router'
import { ItemDetails } from '../board/ItemDetails.tsx'
import { de } from '../i18n/de.ts'
import { Layout } from '../ui/Layout.tsx'

/** `/i/:itemId`: permalink of cards and the detail view on phones (PLAN.md 5.4). */
export function ItemPage() {
  const { itemId = '' } = useParams()
  const navigate = useNavigate()
  return (
    <Layout>
      <button type="button" onClick={() => navigate(-1)} className="mb-2 text-sm text-[var(--wb-accent)]">
        ← {de.details.back}
      </button>
      <div className="mx-auto max-w-xl rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)]">
        <ItemDetails itemId={itemId} />
      </div>
    </Layout>
  )
}
