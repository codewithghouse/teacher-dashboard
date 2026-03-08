interface StatCardProps {
  value: string;
  label: string;
  badge?: string;
  badgeVariant?: "green" | "red" | "yellow" | "blue";
  iconColor?: "blue" | "yellow" | "red" | "green";
}

const iconColorMap = {
  blue: "bg-edu-light-blue",
  yellow: "bg-edu-light-yellow",
  red: "bg-edu-light-red",
  green: "bg-edu-light-green",
};

const badgeColorMap = {
  green: "bg-edu-light-green text-edu-green",
  red: "bg-edu-light-red text-edu-red",
  yellow: "bg-edu-light-yellow text-edu-orange",
  blue: "bg-edu-light-blue text-edu-blue",
};

const StatCard = ({ value, label, badge, badgeVariant = "green", iconColor = "blue" }: StatCardProps) => {
  return (
    <div className="stat-card">
      <div className="flex flex-col gap-1">
        <div className={`stat-icon ${iconColorMap[iconColor]}`}>
          <div className="w-4 h-4 rounded bg-current opacity-30" />
        </div>
        <p className="text-3xl font-bold text-foreground mt-2">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {badge && (
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeColorMap[badgeVariant]}`}>
          {badge}
        </span>
      )}
    </div>
  );
};

export default StatCard;
