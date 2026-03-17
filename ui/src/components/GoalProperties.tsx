import { useCallback, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { Goal, StartsAtPrecision } from "@paperclipai/shared";
import { GOAL_STATUSES, GOAL_LEVELS } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "./StatusBadge";
import { formatDate, formatDateTimeLocal, cn, agentUrl } from "../lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar, X } from "lucide-react";

interface GoalPropertiesProps {
  goal: Goal;
  onUpdate?: (data: Record<string, unknown>) => void;
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 w-20">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">{children}</div>
    </div>
  );
}

function label(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const PRECISION_LABELS: Record<StartsAtPrecision, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  datetime: "Exact time",
};

function formatStartsAt(date: Date | string, precision: StartsAtPrecision): string {
  const d = new Date(date);
  if (precision === "datetime") return formatDateTimeLocal(d);
  if (precision === "week") return `Week of ${formatDate(d)}`;
  if (precision === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(d);
  }
  return formatDate(d);
}

function dateToLocalInput(date: Date | string): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateToDateInput(date: Date | string): string {
  return dateToLocalInput(date).slice(0, 10);
}

function PickerButton({
  current,
  options,
  onChange,
  children,
}: {
  current: string;
  options: readonly string[];
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="cursor-pointer hover:opacity-80 transition-opacity">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="end">
        {options.map((opt) => (
          <Button
            key={opt}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start text-xs", opt === current && "bg-accent")}
            onClick={() => {
              onChange(opt);
              setOpen(false);
            }}
          >
            {label(opt)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function GoalProperties({ goal, onUpdate }: GoalPropertiesProps) {
  const { selectedCompanyId } = useCompany();
  const [startsAtOpen, setStartsAtOpen] = useState(false);

  const handleStartsAtDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val || !onUpdate) return;
    const precision = goal.startsAtPrecision ?? "day";
    onUpdate({ startsAt: new Date(val).toISOString(), startsAtPrecision: precision });
  }, [goal.startsAtPrecision, onUpdate]);

  const handleStartsAtTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val || !onUpdate) return;
    onUpdate({ startsAt: new Date(val).toISOString(), startsAtPrecision: "datetime" });
  }, [onUpdate]);

  const handleStartsAtPrecisionChange = useCallback((precision: StartsAtPrecision) => {
    if (!goal.startsAt || !onUpdate) return;
    onUpdate({ startsAt: new Date(goal.startsAt).toISOString(), startsAtPrecision: precision });
  }, [goal.startsAt, onUpdate]);

  const handleClearStartsAt = useCallback(() => {
    if (!onUpdate) return;
    onUpdate({ startsAt: null });
    setStartsAtOpen(false);
  }, [onUpdate]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const ownerAgent = goal.ownerAgentId
    ? agents?.find((a) => a.id === goal.ownerAgentId)
    : null;

  const parentGoal = goal.parentId
    ? allGoals?.find((g) => g.id === goal.parentId)
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <PropertyRow label="Status">
          {onUpdate ? (
            <PickerButton
              current={goal.status}
              options={GOAL_STATUSES}
              onChange={(status) => onUpdate({ status })}
            >
              <StatusBadge status={goal.status} />
            </PickerButton>
          ) : (
            <StatusBadge status={goal.status} />
          )}
        </PropertyRow>

        <PropertyRow label="Level">
          {onUpdate ? (
            <PickerButton
              current={goal.level}
              options={GOAL_LEVELS}
              onChange={(level) => onUpdate({ level })}
            >
              <span className="text-sm capitalize">{goal.level}</span>
            </PickerButton>
          ) : (
            <span className="text-sm capitalize">{goal.level}</span>
          )}
        </PropertyRow>

        <PropertyRow label="Owner">
          {ownerAgent ? (
            <Link
              to={agentUrl(ownerAgent)}
              className="text-sm hover:underline"
            >
              {ownerAgent.name}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">None</span>
          )}
        </PropertyRow>

        {/* Starts row */}
        <PropertyRow label="Starts">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Popover open={startsAtOpen} onOpenChange={setStartsAtOpen}>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {goal.startsAt ? (
                    <span className="text-sm">
                      {formatStartsAt(goal.startsAt, goal.startsAtPrecision ?? "day")}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">No start date</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <div className="space-y-2">
                  {(goal.startsAtPrecision ?? "day") !== "datetime" && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Date</label>
                      <input
                        type="date"
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
                        value={goal.startsAt ? dateToDateInput(goal.startsAt) : ""}
                        onChange={handleStartsAtDateChange}
                      />
                    </div>
                  )}
                  {goal.startsAtPrecision === "datetime" && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Date & time</label>
                      <input
                        type="datetime-local"
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
                        value={goal.startsAt ? dateToLocalInput(goal.startsAt) : ""}
                        onChange={handleStartsAtTimeChange}
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Precision</label>
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(PRECISION_LABELS) as StartsAtPrecision[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={cn(
                            "px-2 py-0.5 text-xs rounded border border-border hover:bg-accent/50 transition-colors",
                            (goal.startsAtPrecision ?? "day") === p && "bg-accent font-medium",
                          )}
                          onClick={() => handleStartsAtPrecisionChange(p)}
                          disabled={!goal.startsAt}
                        >
                          {PRECISION_LABELS[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {goal.startsAt && onUpdate && (
              <button
                type="button"
                className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                onClick={handleClearStartsAt}
                title="Clear start date"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </PropertyRow>

        {goal.parentId && (
          <PropertyRow label="Parent Goal">
            <Link
              to={`/goals/${goal.parentId}`}
              className="text-sm hover:underline"
            >
              {parentGoal?.title ?? goal.parentId.slice(0, 8)}
            </Link>
          </PropertyRow>
        )}
      </div>

      <Separator />

      <div className="space-y-1">
        <PropertyRow label="Created">
          <span className="text-sm">{formatDate(goal.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label="Updated">
          <span className="text-sm">{formatDate(goal.updatedAt)}</span>
        </PropertyRow>
      </div>
    </div>
  );
}
