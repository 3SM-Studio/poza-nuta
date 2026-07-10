CREATE UNIQUE INDEX "platform_members_one_active_owner_idx" ON "platform_members" USING btree ("role") WHERE "platform_members"."role" = 'platform_owner' AND "platform_members"."active" = true;
