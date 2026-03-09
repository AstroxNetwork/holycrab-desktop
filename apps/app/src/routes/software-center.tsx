import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/software-center')({
  component: () => <Navigate to="/chat" replace />,
})
