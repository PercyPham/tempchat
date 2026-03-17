package config

func App() appConfig { ensureConfigLoaded(); return app }

var app appConfig

type appConfig struct {
	Mode           string
	Port           string
	GinMode        string
	AllowedOrigins string
}

func loadAppConfig() {
	app = appConfig{
		Mode:           getEnv("APP_MODE", "dev"),
		Port:           getEnv("PORT", "8080"),
		GinMode:        getEnv("GIN_MODE", "debug"),
		AllowedOrigins: getENV("ALLOWED_ORIGINS"),
	}
}
