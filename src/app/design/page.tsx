import { notFound } from 'next/navigation';
import { DesignCatalogue } from './DesignCatalogue';

export default function DesignPage() {
  if (process.env.NODE_ENV !== 'development' || process.env.OPERATOR_MODE === 'true') {
    notFound();
  }

  return <DesignCatalogue />;
}
