import { useRef } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "@/components/ui/button";

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
        <AlertDialog.Overlay className="account-dialog__overlay" />
        <AlertDialog.Content
          className="account-dialog__content"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <AlertDialog.Title className="account-dialog__title">
            GitHub에서 로그아웃할까요?
          </AlertDialog.Title>
          <AlertDialog.Description className="account-dialog__description">
            로컬 워크스페이스와 문서는 유지되며 GitHub 동기화, Issue와 PR 기능은
            다시 로그인할 때까지 사용할 수 없습니다.
          </AlertDialog.Description>
          <div className="account-dialog__actions">
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
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
