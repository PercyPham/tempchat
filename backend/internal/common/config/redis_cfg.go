package config

func Redis() redisConfig { ensureConfigLoaded(); return redis }

var redis redisConfig

type redisConfig struct {
	Addr string
}

func loadRedisConfig() {
	redis = redisConfig{
		Addr: getEnv("REDIS_ADDR", "127.0.0.1:6379"),
	}
}
