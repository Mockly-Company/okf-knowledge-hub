use crate::settings::service::LocalSettingsService;
use crate::workspace::service::PreviewRegistry;

pub struct AppServices {
    pub initialization_previews: PreviewRegistry,
    pub local_settings: LocalSettingsService,
}

impl AppServices {
    pub fn new(local_settings: LocalSettingsService) -> Self {
        Self {
            initialization_previews: PreviewRegistry::default(),
            local_settings,
        }
    }
}
