export default function OptimizationStatCard({
    icon,
    value,
    label,
    subtitle,
    variant = "default"
}) {
    return (
        <div className={`opt-stat-card ${variant}`}>
            <div className="opt-stat-icon-wrap">
                {icon}
            </div>
            <div className="opt-stat-info">
                <strong className="opt-stat-val">
                    {typeof value === "number" ? value.toLocaleString() : value}
                </strong>
                <span className="opt-stat-lbl">{label}</span>
                {subtitle && (
                    <span className="opt-stat-sub">{subtitle}</span>
                )}
            </div>
        </div>
    );
}
