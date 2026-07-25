use crate::auth::service::AuthService;
use crate::settings::service::LocalSettingsService;
use crate::workspace::service::PreviewRegistry;

pub struct AppServices {
    /// Populated by the desktop app. Settings-only tests deliberately leave it
    /// empty so they never initialize the developer's real credential store.
    pub auth: Option<AuthService>,
    pub initialization_previews: PreviewRegistry,
    pub local_settings: LocalSettingsService,
}

impl AppServices {
    pub fn new(local_settings: LocalSettingsService) -> Self {
        Self {
            auth: None,
            initialization_previews: PreviewRegistry::default(),
            local_settings,
        }
    }

    pub fn with_auth(local_settings: LocalSettingsService, auth: AuthService) -> Self {
        Self {
            auth: Some(auth),
            initialization_previews: PreviewRegistry::default(),
            local_settings,
        }
    }
}
