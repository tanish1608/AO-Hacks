import Image from 'next/image';
/**
 * The product mark. The artwork carries its own frame, so it sits on a plain
 * background. Served unoptimized, as the app's other icons are: the optimizer
 * only redirects to the original here, and this is already a 128px asset.
 */
export default function BrandLogo({
  size = 28,
  className = 'brand-logo',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      unoptimized
      src="/logo-mark.png"
      alt="Agent Foundry"
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}
