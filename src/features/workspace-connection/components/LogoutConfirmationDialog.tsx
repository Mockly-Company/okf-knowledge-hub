import { useRef } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { dialogOverlayClassName, dialogSurfaceClassName, dialogPositionClassName, dialogDefaultWidthClassName, dialogTitleClassName, dialogDescriptionClassName } from "@/components/ui/dialog-styles";

interface LogoutConfirmationDialogProps {
  disabled?: boolean;
  onConfirm(): void | Promise<void>;
}

export function LogoutConfirmationDialog({
  disabled = false,
  onConfirm,
}: LogoutConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button type="button" variant="secondary" disabled={disabled}>
          로그아웃
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClassName} />
        <AlertDialog.Content
          className={`${dialogSurfaceClassName} ${dialogPositionClassName} ${dialogDefaultWidthClassName} gap-[var(--space-6)]`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <AlertDialog.Title className={dialogTitleClassName}>
            GitHub에서 로그아웃할까요?
          </AlertDialog.Title>
          <DialogBody><AlertDialog.Description className={dialogDescriptionClassName}>
            로컬 워크스페이스와 문서는 유지되며 GitHub 동기화, Issue와 PR 기능은
            다시 로그인할 때까지 사용할 수 없습니다.
          </AlertDialog.Description></DialogBody>
          <DialogFooter>
            <AlertDialog.Cancel asChild>
              <Button ref={cancelRef} type="button" variant="secondary">
                취소
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onConfirm()}
              >
                GitHub에서 로그아웃
              </Button>
            </AlertDialog.Action>
          </DialogFooter>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
