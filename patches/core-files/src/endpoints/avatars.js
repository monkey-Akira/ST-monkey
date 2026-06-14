import path from 'node:path';
import fs from 'node:fs';

import express from 'express';
import sanitize from 'sanitize-filename';
import { Jimp, JimpMime } from '../jimp.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getImages, tryParse } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { invalidateThumbnail } from './thumbnails.js';
import cacheBuster from '../middleware/cacheBuster.js';
import { AVATAR_HEIGHT, AVATAR_WIDTH } from '../constants.js';

export const router = express.Router();

async function cropResizeAvatar(jimp, crop, mime = JimpMime.jpeg) {
    if (!(jimp instanceof Jimp)) {
        throw new TypeError('Expected a Jimp instance');
    }

    const image = /** @type {InstanceType<typeof Jimp>} */ (jimp);
    let finalWidth = image.bitmap.width;
    let finalHeight = image.bitmap.height;
    if (typeof crop == 'object' && [crop.x, crop.y, crop.width, crop.height].every(x => typeof x === 'number')) {
        image.crop({ x: crop.x, y: crop.y, w: crop.width, h: crop.height });
        if (crop.want_resize) {
            finalWidth = AVATAR_WIDTH;
            finalHeight = AVATAR_HEIGHT;
        } else {
            finalWidth = crop.width;
            finalHeight = crop.height;
        }
    }

    image.cover({ w: finalWidth, h: finalHeight });
    if (mime === JimpMime.jpeg) {
        return await image.getBuffer(mime, { jpegColorSpace: 'rgb' });
    }

    return await image.getBuffer(mime);
}

function getAvatarUploadTarget(overwriteName) {
    if (overwriteName) {
        const filename = sanitize(overwriteName);
        const ext = path.extname(filename).toLowerCase();
        return {
            filename: ext ? filename : `${filename}.jpg`,
            mime: ext === '.png' ? JimpMime.png : JimpMime.jpeg,
        };
    }

    return {
        filename: `${Date.now()}.jpg`,
        mime: JimpMime.jpeg,
    };
}

router.post('/get', function (request, response) {
    const images = getImages(request.user.directories.avatars);
    response.send(images);
});

router.post('/delete', getFileNameValidationFunction('avatar'), function (request, response) {
    if (!request.body) return response.sendStatus(400);

    if (request.body.avatar !== sanitize(request.body.avatar)) {
        console.error('Malicious avatar name prevented');
        return response.sendStatus(403);
    }

    const fileName = path.join(request.user.directories.avatars, sanitize(request.body.avatar));

    if (fs.existsSync(fileName)) {
        fs.unlinkSync(fileName);
        invalidateThumbnail(request.user.directories, 'persona', sanitize(request.body.avatar));
        return response.send({ result: 'ok' });
    }

    return response.sendStatus(404);
});

router.post('/upload', getFileNameValidationFunction('overwrite_name'), async (request, response) => {
    if (!request.file) return response.sendStatus(400);

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const crop = tryParse(request.query.crop);
        const target = getAvatarUploadTarget(request.body.overwrite_name);
        const rawImg = await Jimp.read(pathToUpload);
        const image = await cropResizeAvatar(rawImg, crop, target.mime);

        // Remove previous thumbnail and bust cache if overwriting
        if (request.body.overwrite_name) {
            invalidateThumbnail(request.user.directories, 'persona', sanitize(request.body.overwrite_name));
            cacheBuster.bust(request, response);
        }

        const filename = target.filename;
        const pathToNewFile = path.join(request.user.directories.avatars, filename);
        writeFileAtomicSync(pathToNewFile, image);
        fs.unlinkSync(pathToUpload);
        return response.send({ path: filename });
    } catch (err) {
        console.error('Error uploading user avatar:', err);
        return response.status(400).send('Is not a valid image');
    }
});
