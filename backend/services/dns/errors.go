package dns

import "errors"

var (
	ErrUnsupportedPlatform = errors.New("不支持的DNS平台类型")
	ErrInvalidCredentials  = errors.New("无效的API凭证")
	ErrDomainNotFound      = errors.New("域名未找到")
	ErrRecordNotFound      = errors.New("记录未找到")
	ErrAPIRequest          = errors.New("API请求失败")
)
