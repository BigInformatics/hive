import { useState } from "react";

const COLORS = [
  "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-green-500",
  "bg-teal-500", "bg-sky-500", "bg-blue-500", "bg-violet-500",
  "bg-purple-500", "bg-pink-500",
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface UserAvatarProps {
  name: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const SIZE_MAP = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-5 w-5 text-[9px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

/**
 * User avatar with API-backed image and initials fallback.
 * Tries /api/avatars/<name> first; on error shows colored initials.
 */
export function UserAvatar({ name, className = "", size = "md" }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass = SIZE_MAP[size];
  const initials = name.slice(0, 2).toUpperCase();
  const bgColor = hashColor(name);

  if (imgError) {
    return (
      <div
        className={`${sizeClass} rounded-full ${bgColor} text-white flex items-center justify-center font-bold select-none ${className}`}
        title={name}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={`/api/avatars/${name}`}
      alt={name}
      className={`${sizeClass} rounded-full object-cover ${className}`}
      title={name}
      onError={() => setImgError(true)}
    />
  );
}
