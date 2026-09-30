import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Página no encontrada"
      description="La dirección no existe o fue movida."
      action={
        <Button asChild>
          <Link to="/">Volver al Dashboard</Link>
        </Button>
      }
    />
  );
}
