import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Shared SVG wrapper. Icons are decorative by default (aria-hidden, not focusable);
 * the surrounding control must carry the accessible name.
 */
export function BaseIcon({ size = 18, className = "", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <polyline points="20 6 9 17 4 12"></polyline>
  </BaseIcon>
);

export const FolderIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </BaseIcon>
);

export const FileIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </BaseIcon>
);

export const CloudIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
  </BaseIcon>
);

export const TrashIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M3 6h18"></path>
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
  </BaseIcon>
);

export const DownloadIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </BaseIcon>
);

export const EyeIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </BaseIcon>
);

export const MailIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <rect width="20" height="16" x="2" y="4" rx="2"></rect>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
  </BaseIcon>
);

export const UploadIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </BaseIcon>
);

export const ChevronRightIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="m9 18 6-6-6-6"></path>
  </BaseIcon>
);

export const SearchIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="11" cy="11" r="8"></circle>
    <path d="m21 21-4.3-4.3"></path>
  </BaseIcon>
);

export const PaperclipIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
  </BaseIcon>
);

export const PlusIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </BaseIcon>
);

export const SendIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </BaseIcon>
);

export const MessageIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </BaseIcon>
);

export const EditIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </BaseIcon>
);

export const CloseIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </BaseIcon>
);

export const MenuIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </BaseIcon>
);

export const ChevronLeftIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="m15 18-6-6 6-6"></path>
  </BaseIcon>
);

export const AlertCircleIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </BaseIcon>
);

export const LockIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </BaseIcon>
);

export const MoreVerticalIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="12" cy="5" r="1"></circle>
    <circle cx="12" cy="19" r="1"></circle>
  </BaseIcon>
);

export const RefreshCwIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </BaseIcon>
);

export const FilesIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
    <path d="M10 9H8"></path>
    <path d="M16 13H8"></path>
    <path d="M16 17H8"></path>
  </BaseIcon>
);

export const ReplyIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <polyline points="9 17 4 12 9 7"></polyline>
    <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
  </BaseIcon>
);

export const ArchiveIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <polyline points="21 8 21 21 3 21 3 8"></polyline>
    <rect x="1" y="3" width="22" height="5"></rect>
    <line x1="10" y1="12" x2="14" y2="12"></line>
  </BaseIcon>
);

export const SaveIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
    <polyline points="17 21 17 13 7 13 7 21"></polyline>
    <polyline points="7 3 7 8 15 8"></polyline>
  </BaseIcon>
);

export const FileTextIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </BaseIcon>
);

export const ShareIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="18" cy="5" r="3"></circle>
    <circle cx="6" cy="12" r="3"></circle>
    <circle cx="18" cy="19" r="3"></circle>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
  </BaseIcon>
);

export const LinkIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </BaseIcon>
);




export const EyeOffIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
    <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
    <line x1="2" y1="2" x2="22" y2="22"></line>
  </BaseIcon>
);

export const InfoIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </BaseIcon>
);

export const AlertTriangleIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </BaseIcon>
);

export const ArrowRightIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </BaseIcon>
);

export const LogOutIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </BaseIcon>
);

export const MoreHorizontalIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="19" cy="12" r="1"></circle>
    <circle cx="5" cy="12" r="1"></circle>
  </BaseIcon>
);

export const FolderPlusIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    <line x1="12" y1="11" x2="12" y2="17"></line>
    <line x1="9" y1="14" x2="15" y2="14"></line>
  </BaseIcon>
);

export const HomeIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    <polyline points="9 22 9 12 15 12 15 22"></polyline>
  </BaseIcon>
);

export const CopyIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </BaseIcon>
);

export const ArrowDownIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <polyline points="19 12 12 19 5 12"></polyline>
  </BaseIcon>
);

export const ClockIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </BaseIcon>
);

export const HistoryIcon = ({ size = 18, className = "" }: IconProps) => (
  <BaseIcon size={size} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>
    <polyline points="3 3 3 8 8 8"></polyline>
    <polyline points="12 7 12 12 15 14"></polyline>
  </BaseIcon>
);
