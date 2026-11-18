package com.preface.api.auth.service.oauth;

import com.preface.common.user.entity.OAuthProvider;

/** 제공자에서 받은 사용자 정보. 이메일은 사용자가 제공자 동의에서 뺐으면 null이다. */
public record OAuthProfile(
        OAuthProvider provider, String providerUserId, String nickname, String email) {}
