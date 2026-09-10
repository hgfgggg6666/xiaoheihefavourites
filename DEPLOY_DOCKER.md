# 小黑盒收藏助手 - Docker 部署指南

## 系统要求

- Ubuntu 24.04（或其他支持 Docker 的 Linux 发行版）
- Docker 20.10+
- Docker Compose v2+
- 至少 1GB 内存（建议 2GB）
- 至少 2GB 磁盘空间

---

## 一、上传项目到服务器

### 方式 1：使用 Git（推荐）

```bash
# 在服务器上克隆仓库
git clone https://github.com/hgfgggg6666/xiaoheihefavourites.git
cd xiaoheihefavourites
```

### 方式 2：使用 SCP 上传

```bash
# 在本地电脑执行（把项目打包上传）
scp -r xiaoheihefavourites user@your-server-ip:/home/user/
```

### 方式 3：使用 rsync（推荐大文件）

```bash
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  xiaoheihefavourites/ user@your-server-ip:/home/user/xiaoheihefavourites/
```

---

## 二、安装 Docker 和 Docker Compose

如果服务器还没有安装 Docker，执行以下命令：

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh

# 将当前用户加入 docker 组（避免每次都用 sudo）
sudo usermod -aG docker $USER

# 重新登录或执行以下命令使组生效
newgrp docker

# 验证安装
docker --version
docker compose version
```

---

## 三、部署应用

### 1. 进入项目目录

```bash
cd /home/user/xiaoheihefavourites
```

### 2. 创建必要的目录

```bash
mkdir -p data media logs
```

### 3. 构建并启动容器

```bash
# 构建镜像并启动（首次会比较慢，需要 5-10 分钟）
docker compose up -d --build

# 查看构建日志
docker compose logs -f --build
```

### 4. 查看容器状态

```bash
# 查看容器运行状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail 100
```

---

## 四、访问应用

### 1. 本地访问

部署完成后，在浏览器中访问：

```
http://your-server-ip:3000/app/
```

把 `your-server-ip` 替换成你的服务器 IP 地址。

### 2. 配置防火墙

如果无法访问，可能需要开放 3000 端口：

```bash
# Ubuntu ufw 防火墙
sudo ufw allow 3000/tcp
sudo ufw reload

# 或者使用 iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

### 3. 云服务器安全组

如果使用的是阿里云、腾讯云、华为云等云服务器，还需要在云控制台的**安全组**中开放 3000 端口。

---

## 五、配置域名和 HTTPS（可选）

如果有域名，可以使用 Nginx 反向代理 + Let's Encrypt 配置 HTTPS。

### 1. 安装 Nginx 和 Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. 配置 Nginx 反向代理

```bash
sudo nano /etc/nginx/sites-available/xiaoheihe
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

### 3. 启用配置并测试

```bash
sudo ln -s /etc/nginx/sites-available/xiaoheihe /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. 申请 SSL 证书

```bash
sudo certbot --nginx -d your-domain.com
```

按照提示操作，Certbot 会自动配置 HTTPS 并设置自动续期。

---

## 六、数据持久化和备份

### 数据目录说明

Docker 容器通过 volume 挂载了以下目录，数据会保存在服务器本地：

| 目录 | 说明 |
|------|------|
| `./data` | SQLite 数据库文件（app.db） |
| `./media` | 下载的帖子图片 |
| `./logs` | 应用日志 |

### 备份数据

```bash
# 创建备份目录
mkdir -p ~/backups

# 备份数据（包含数据库、图片、日志）
tar -czf ~/backups/xiaoheihe-backup-$(date +%Y%m%d).tar.gz data media logs

# 查看备份文件
ls -lh ~/backups/
```

### 恢复数据

```bash
# 停止容器
docker compose down

# 恢复备份
tar -xzf ~/backups/xiaoheihe-backup-YYYYMMDD.tar.gz

# 重新启动
docker compose up -d
```

### 自动备份（可选）

创建定时任务每天自动备份：

```bash
crontab -e
```

添加以下内容（每天凌晨 3 点备份，保留最近 7 天）：

```bash
0 3 * * * cd /home/user/xiaoheihefavourites && tar -czf ~/backups/xiaoheihe-backup-$(date +\%Y\%m\%d).tar.gz data media logs && find ~/backups -name "xiaoheihe-backup-*.tar.gz" -mtime +7 -delete
```

---

## 七、常用运维命令

### 容器管理

```bash
# 启动容器
docker compose up -d

# 停止容器
docker compose down

# 重启容器
docker compose restart

# 查看容器状态
docker compose ps

# 进入容器
docker compose exec xiaoheihe-favourites bash
```

### 日志查看

```bash
# 实时查看日志
docker compose logs -f

# 查看最近 100 行
docker compose logs --tail 100

# 只看错误日志
docker compose logs | grep -i error
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose up -d --build

# 查看构建日志
docker compose logs -f --build
```

### 清理空间

```bash
# 查看磁盘使用
docker system df

# 清理未使用的镜像和构建缓存
docker system prune -a

# 清理构建缓存（推荐，不会删除正在使用的镜像）
docker builder prune
```

---

## 八、故障排查

### 容器启动失败

```bash
# 查看容器日志
docker compose logs xiaoheihe-favourites

# 查看容器详细信息
docker inspect xiaoheihe-favourites

# 重新构建（不使用缓存）
docker compose build --no-cache
docker compose up -d
```

### 端口被占用

```bash
# 查看 3000 端口被谁占用
sudo lsof -i :3000
# 或
sudo netstat -tlnp | grep 3000

# 修改 docker-compose.yml 中的端口映射
# 例如改成 "8080:3000"，然后通过 8080 端口访问
```

### 数据库损坏

```bash
# 停止容器
docker compose down

# 备份当前数据库
cp data/app.db data/app.db.bak

# 使用 SQLite 工具检查和修复
docker compose run --rm xiaoheihe-favourites sqlite3 /app/data/app.db "PRAGMA integrity_check;"

# 如果损坏严重，从备份恢复
```

### 内存不足

```bash
# 查看内存使用
free -h

# 添加交换空间（如果内存不足）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 九、性能优化建议

### 1. 限制容器资源使用

在 `docker-compose.yml` 中添加资源限制：

```yaml
services:
  xiaoheihe-favourites:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 2. 配置日志轮转

限制日志文件大小，避免占满磁盘：

```yaml
services:
  xiaoheihe-favourites:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 使用国内镜像加速（可选）

如果构建速度慢，可以配置 Docker 镜像加速器：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

---

## 十、卸载

```bash
# 停止并删除容器
docker compose down

# 删除镜像
docker rmi xiaoheihe-favourites-xiaoheihe-favourites

# 删除数据（谨慎操作！会删除所有收藏数据和图片）
# rm -rf data media logs
```

---

## 快速部署命令汇总

```bash
# 1. 克隆项目
git clone https://github.com/hgfgggg6666/xiaoheihefavourites.git
cd xiaoheihefavourites

# 2. 创建目录
mkdir -p data media logs

# 3. 构建并启动
docker compose up -d --build

# 4. 查看日志
docker compose logs -f

# 5. 访问应用
# 浏览器打开 http://your-server-ip:3000/app/
```

---

如有问题，请查看日志文件 `logs/server.log` 或使用 `docker compose logs -f` 查看实时日志。
