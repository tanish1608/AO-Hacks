import { redirect } from 'next/navigation';
// The historical benchmark remains available from the CLI, outside the product.
export default function LegacyLab() { redirect('/'); }
