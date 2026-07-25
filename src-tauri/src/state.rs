use crate::workspace::service::PreviewRegistry;

#[derive(Default)]
pub struct AppServices {
    pub initialization_previews: PreviewRegistry,
}
