import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-bold text-stone-300">404</p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block font-medium text-brand-700 hover:underline">
        Go home
      </Link>
    </div>
  );
}
