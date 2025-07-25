"use client"
import * as React from "react"
import { addDays, format } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { DateRange } from "react-day-picker";
 
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
 
export default function DatePickerWithRange({date, setDate}: {date: DateRange | undefined, setDate: (date: DateRange | undefined) => void}) {
  return (
    <div className={cn("flex items-center gap-2 sm:gap-4 text-black")}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-auto min-w-[220px] justify-start text-left font-normal px-2",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {/* Clear (X) button */}
      {date?.from || date?.to ? (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Clear date range"
          onClick={() => setDate(undefined)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
}