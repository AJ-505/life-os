import { createFileRoute } from '@tanstack/react-router'

import { LibraryView } from '#/tracker/library/LibraryView'
import { librarySearch } from '#/tracker/library/library-search'

export const Route = createFileRoute('/library')({
  component: LibraryRoute,
  validateSearch: librarySearch,
})

function LibraryRoute() {
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LibraryView
      tab={tab ?? 'shelf'}
      onTab={(next) =>
        void navigate({
          search: { tab: next === 'shelf' ? undefined : next },
          replace: true,
        })
      }
    />
  )
}
