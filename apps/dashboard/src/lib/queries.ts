import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { useApi, useSession } from './session'

export function useOverview() {
  const api = useApi()
  const { signOut } = useSession()
  return useQuery({
    queryKey: ['overview'],
    queryFn: async () => {
      try {
        return await api.overview()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) signOut()
        throw error
      }
    },
    // Live-ish without a stream: the numbers are counters, a 3 s lag is fine.
    refetchInterval: 3000,
  })
}

export function useDeployment(id: string) {
  const api = useApi()
  return useQuery({ queryKey: ['deployment', id], queryFn: () => api.deployment(id) })
}

/** A mutation that refreshes the overview when it settles. */
export function useAction<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['overview'] }),
  })
}
