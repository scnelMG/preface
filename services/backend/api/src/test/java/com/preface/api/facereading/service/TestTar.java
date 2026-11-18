package com.preface.api.facereading.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** 테스트용 ustar tar 만들기(합성 프레임 묶음). Python tarfile이 만드는 일반 파일 헤더와 같은 형식이다. */
final class TestTar {

    private static final int BLOCK = 512;

    private TestTar() {}

    static byte[] of(Map<String, byte[]> entries) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (Map.Entry<String, byte[]> e : entries.entrySet()) {
            byte[] h = new byte[BLOCK];
            byte[] name = e.getKey().getBytes(StandardCharsets.UTF_8);
            System.arraycopy(name, 0, h, 0, Math.min(name.length, 100));
            put(h, 100, "0000644");
            put(h, 108, "0000000");
            put(h, 116, "0000000");
            put(h, 124, String.format("%011o", e.getValue().length));
            put(h, 136, "00000000000");
            h[156] = '0';
            put(h, 257, "ustar");
            put(h, 263, "00");
            for (int i = 148; i < 156; i++) h[i] = ' ';
            int sum = 0;
            for (byte b : h) sum += b & 0xff;
            put(h, 148, String.format("%06o", sum));
            h[154] = 0;
            out.write(h);
            out.write(e.getValue());
            out.write(new byte[(BLOCK - e.getValue().length % BLOCK) % BLOCK]);
        }
        out.write(new byte[BLOCK * 2]);
        return out.toByteArray();
    }

    private static void put(byte[] h, int offset, String value) {
        byte[] b = value.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(b, 0, h, offset, b.length);
    }
}
