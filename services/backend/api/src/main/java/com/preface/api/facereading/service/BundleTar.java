package com.preface.api.facereading.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * 프레임 묶음(압축 없는 tar, {@code contracts/frame-extraction} "묶음 형식")에서 필요한 파일만 꺼낸다.
 *
 * <p>의존성을 늘리지 않으려고 ustar 헤더(512바이트)를 직접 읽는다. Python {@code tarfile}이 긴 이름 등에 붙이는 PAX 헤더({@code x})의
 * {@code path}도 따른다. 그 밖의 형식(GNU 긴 이름 {@code L}, sparse 등)은 묶음에 나오지 않아 다루지 않는다.
 */
final class BundleTar {

    private static final int BLOCK = 512;

    /** 이 크기를 넘는 파일은 읽지 않는다(묶음 프레임은 3200px JPEG라도 수 MB). */
    static final long MAX_ENTRY_BYTES = 32L * 1024 * 1024;

    private BundleTar() {}

    /**
     * tar를 끝까지 읽어 {@code wanted}에 맞는 일반 파일만 이름 → 내용으로 돌려준다. 이름의 앞 {@code ./}는 뗀다.
     *
     * @throws FaceReadingFailure 형식이 깨졌거나 파일이 너무 크면 {@code BAD_BUNDLE}
     */
    static Map<String, byte[]> read(InputStream in, Predicate<String> wanted) throws IOException {
        Map<String, byte[]> files = new HashMap<>();
        byte[] header = new byte[BLOCK];
        String paxPath = null;
        while (true) {
            if (!readFully(in, header)) break;
            if (isZero(header)) break;
            String name = ustarName(header);
            long size = octal(header, 124, 12);
            char type = (char) (header[156] == 0 ? '0' : header[156]);
            if (size < 0 || size > MAX_ENTRY_BYTES) {
                throw new FaceReadingFailure(
                        FaceReadingFailure.BAD_BUNDLE, "tar entry size " + size);
            }
            long padded = (size + BLOCK - 1) / BLOCK * BLOCK;
            if (type == 'x') {
                paxPath = paxPathOf(readBytes(in, size));
                skip(in, padded - size);
                continue;
            }
            if (paxPath != null) {
                name = paxPath;
                paxPath = null;
            }
            if (name.startsWith("./")) name = name.substring(2);
            if ((type == '0' || type == '7') && wanted.test(name)) {
                files.put(name, readBytes(in, size));
                skip(in, padded - size);
            } else {
                skip(in, padded);
            }
        }
        return files;
    }

    private static String ustarName(byte[] h) {
        String name = text(h, 0, 100);
        boolean ustar = "ustar".equals(text(h, 257, 6).trim());
        String prefix = ustar ? text(h, 345, 155) : "";
        return prefix.isEmpty() ? name : prefix + "/" + name;
    }

    /** PAX 레코드 {@code "<길이> path=<값>\n"}에서 path만 꺼낸다. */
    private static String paxPathOf(byte[] data) {
        for (String record : new String(data, StandardCharsets.UTF_8).split("\n")) {
            int space = record.indexOf(' ');
            if (space > 0 && record.startsWith("path=", space + 1)) {
                return record.substring(space + 1 + "path=".length());
            }
        }
        return null;
    }

    private static String text(byte[] h, int offset, int length) {
        int end = offset;
        while (end < offset + length && h[end] != 0) end++;
        return new String(h, offset, end - offset, StandardCharsets.UTF_8);
    }

    private static long octal(byte[] h, int offset, int length) {
        String s = text(h, offset, length).trim();
        if (s.isEmpty()) return 0;
        try {
            return Long.parseLong(s, 8);
        } catch (NumberFormatException e) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "tar size field");
        }
    }

    private static boolean isZero(byte[] block) {
        for (byte b : block) if (b != 0) return false;
        return true;
    }

    private static boolean readFully(InputStream in, byte[] buffer) throws IOException {
        int read = in.readNBytes(buffer, 0, buffer.length);
        if (read == 0) return false;
        if (read < buffer.length) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "truncated tar header");
        }
        return true;
    }

    private static byte[] readBytes(InputStream in, long size) throws IOException {
        byte[] data = in.readNBytes((int) size);
        if (data.length < size) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "truncated tar entry");
        }
        return data;
    }

    private static void skip(InputStream in, long n) throws IOException {
        long left = n;
        while (left > 0) {
            long skipped = in.skip(left);
            if (skipped <= 0) {
                if (in.read() < 0) {
                    throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "truncated tar");
                }
                skipped = 1;
            }
            left -= skipped;
        }
    }
}
