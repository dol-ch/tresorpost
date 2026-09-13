// Original open-source mark for the public build (MIT). A minimal padlock,
// drawn in currentColor so it inherits the surrounding text color.
export function Emblem() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <path
                d="M7 10V7a5 5 0 0 1 10 0v3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <rect
                x="4.5"
                y="10"
                width="15"
                height="10.5"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="2"
            />
            <circle cx="12" cy="15" r="1.6" fill="currentColor" />
            <path
                d="M12 16.4v1.6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}
