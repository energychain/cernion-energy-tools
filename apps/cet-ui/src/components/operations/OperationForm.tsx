export function OperationForm({
  operationId,
  onPrepare,
}: {
  operationId: string;
  onPrepare?: (operationId: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onPrepare?.(operationId);
      }}
    >
      <button type="submit">Vorbereiten</button>
    </form>
  );
}
