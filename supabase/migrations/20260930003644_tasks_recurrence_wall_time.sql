-- Step 1.8: keep a repeating task's intended local time in its rule.
--
-- Without it, the next occurrence reuses the previous occurrence's local time,
-- so a daily 02:30 task shifted to 03:30 by the spring-forward gap stays at
-- 03:30 forever. The standard RRULE parts BYHOUR/BYMINUTE record the intended
-- wall-clock time (in recurrence_tz). Mirrors src/lib/time/recurrence.ts.

alter table public.tasks drop constraint tasks_recurrence_check;

alter table public.tasks add constraint tasks_recurrence_check check (recurrence ~ (
  '^(FREQ=DAILY'
  || '|FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  || '|FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)'
  || '|FREQ=WEEKLY;INTERVAL=([2-9]|[1-4][0-9]|5[0-2]);BYDAY=(MO|TU|WE|TH|FR|SA|SU)'
  || '|FREQ=MONTHLY;BYMONTHDAY=([1-9]|1[0-9]|2[0-8]|-1)'
  || '|FREQ=MONTHLY;BYDAY=([1-4]|-1)(MO|TU|WE|TH|FR|SA|SU))'
  || '(;BYHOUR=([0-9]|1[0-9]|2[0-3]);BYMINUTE=([0-9]|[1-5][0-9]))?$'
));

-- Backfill: record each existing rule's current local time, so no row relies
-- on the fallback. (A row already shifted by a past gap keeps its shifted time;
-- the original intent isn't recoverable.)
update public.tasks
   set recurrence = recurrence
       || ';BYHOUR=' || extract(hour from due_at at time zone recurrence_tz)::int
       || ';BYMINUTE=' || extract(minute from due_at at time zone recurrence_tz)::int
 where recurrence is not null
   and recurrence !~ ';BYHOUR=';
