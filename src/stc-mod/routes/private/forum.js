/**
 * SillyTavernchat Module - Forum API
 * Community forum with posts, comments, likes.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireAdminMiddleware } from '../../../users.js';
import { getStcDataDir } from '../../config.js';

export const router = express.Router();

function getForumDir() {
    const dir = path.join(getStcDataDir(), 'forum_data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getImagesDir() {
    const dir = path.join(getForumDir(), 'images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function loadPosts() {
    const filePath = path.join(getForumDir(), 'posts.json');
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return []; }
}

function savePosts(posts) {
    fs.writeFileSync(path.join(getForumDir(), 'posts.json'), JSON.stringify(posts, null, 2), 'utf8');
}

// List posts
router.get('/posts', (req, res) => {
    const category = String(req.query.category || '');
    const page  = parseInt(String(req.query.page  || '1'),  10);
    const limit = parseInt(String(req.query.limit || '20'), 10);
    let posts = loadPosts().filter(p => !p.deleted);
    if (category) posts = posts.filter(p => p.category === category);
    posts.sort((a, b) => b.createdAt - a.createdAt);
    const start = (page - 1) * limit;
    const paged = posts.slice(start, start + limit);
    res.json({ posts: paged, total: posts.length, page, limit });
});

// Get single post
router.get('/posts/:id', (req, res) => {
    const posts = loadPosts();
    const post = posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.views = (post.views || 0) + 1;
    savePosts(posts);
    res.json(post);
});

// Create post
router.post('/posts', (req, res) => {
    try {
        const { title, content, category, tags } = req.body;
        if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
        const posts = loadPosts();
        const post = {
            id: crypto.randomUUID(),
            title, content,
            category: category || 'general',
            tags: Array.isArray(tags) ? tags : [],
            author: req.user.profile.handle,
            authorName: req.user.profile.name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            views: 0,
            likes: [],
            comments: [],
            closed: false,
            deleted: false,
        };
        posts.push(post);
        savePosts(posts);
        res.json({ success: true, post });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add comment
router.post('/posts/:id/comments', (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '评论内容不能为空' });
        const posts = loadPosts();
        const post = posts.find(p => p.id === req.params.id && !p.deleted);
        if (!post) return res.status(404).json({ error: '帖子不存在' });
        if (post.closed) return res.status(403).json({ error: '帖子已关闭' });
        const comment = {
            id: crypto.randomUUID(),
            content,
            author: req.user.profile.handle,
            authorName: req.user.profile.name,
            createdAt: Date.now(),
        };
        post.comments.push(comment);
        savePosts(posts);
        res.json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Like/unlike post
router.post('/posts/:id/like', (req, res) => {
    const posts = loadPosts();
    const post = posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const handle = req.user.profile.handle;
    const idx = post.likes.indexOf(handle);
    if (idx >= 0) { post.likes.splice(idx, 1); }
    else { post.likes.push(handle); }
    savePosts(posts);
    res.json({ success: true, liked: idx < 0, count: post.likes.length });
});

// Admin: close/delete post
router.post('/posts/:id/close', requireAdminMiddleware, (req, res) => {
    const posts = loadPosts();
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.closed = !post.closed;
    savePosts(posts);
    res.json({ success: true, closed: post.closed });
});

router.post('/posts/:id/delete', (req, res) => {
    const posts = loadPosts();
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const handle = req.user.profile.handle;
    const isAdmin = req.user.profile.admin;
    if (post.author !== handle && !isAdmin) return res.status(403).json({ error: '无权限' });
    post.deleted = true;
    savePosts(posts);
    res.json({ success: true });
});

// Delete comment (author or admin)
router.post('/posts/:id/comments/:commentId/delete', (req, res) => {
    const posts = loadPosts();
    const post = posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const handle = req.user.profile.handle;
    const isAdmin = req.user.profile.admin;
    const idx = post.comments.findIndex(c => c.id === req.params.commentId);
    if (idx < 0) return res.status(404).json({ error: '评论不存在' });
    if (post.comments[idx].author !== handle && !isAdmin) return res.status(403).json({ error: '无权限' });
    // Soft delete: mark as deleted and remove replies
    post.comments[idx].deleted = true;
    post.comments[idx].content = '[已删除]';
    savePosts(posts);
    res.json({ success: true });
});

// Add comment (with optional parentId for replies)
router.post('/posts/:id/comments/:commentId/reply', (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '回复内容不能为空' });
        const posts = loadPosts();
        const post = posts.find(p => p.id === req.params.id && !p.deleted);
        if (!post) return res.status(404).json({ error: '帖子不存在' });
        if (post.closed) return res.status(403).json({ error: '帖子已关闭' });
        const parent = post.comments.find(c => c.id === req.params.commentId);
        if (!parent) return res.status(404).json({ error: '父评论不存在' });
        const comment = {
            id: crypto.randomUUID(),
            content,
            parentId: req.params.commentId,
            author: req.user.profile.handle,
            authorName: req.user.profile.name,
            createdAt: Date.now(),
        };
        post.comments.push(comment);
        savePosts(posts);
        res.json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Image upload for forum (base64 JSON, avoids multer/CSRF issues)
router.post('/upload-image', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const { image, filename } = req.body;
        if (!image || !image.startsWith('data:image/')) {
            return res.status(400).json({ error: '无效的图片数据' });
        }
        const [header, b64data] = image.split(',');
        const mimeMatch = header.match(/data:([^;]+)/);
        const mime = mimeMatch?.[1] || 'image/png';
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const buffer = Buffer.from(b64data, 'base64');
        if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片大小不能超过 8MB' });
        const name = `${crypto.randomUUID()}.${ext}`;
        const dir = getImagesDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buffer);
        res.json({ success: true, url: `/api/stc/forum/images/${name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve forum images
router.get('/images/:filename', (req, res) => {
    const filePath = path.resolve(getImagesDir(), req.params.filename);
    if (!fs.existsSync(filePath)) return res.sendStatus(404);
    res.sendFile(filePath);
});
