interface ScreenStubProps {
  title: string;
  note: string;
  phase: number;
}

/** Placeholder body shown for screens whose build phase hasn't started yet. */
export default function ScreenStub({ title, note, phase }: ScreenStubProps) {
  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">{title}</div>
      <div className="mb-6 text-[12.5px] italic text-ink-mute">{note}</div>
      <div className="border border-dashed border-rule px-6 py-10 text-center">
        <div className="font-courier text-[11px] tracking-[0.2em] text-accent">
          PHASE {phase}
        </div>
        <div className="mt-2 text-[13px] italic text-ink-mute">
          This screen is scheduled for phase {phase}.
        </div>
      </div>
    </div>
  );
}
