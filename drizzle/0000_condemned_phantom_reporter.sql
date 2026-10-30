CREATE TABLE "bag" (
	"trainer_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bag_trainer_id_item_id_pk" PRIMARY KEY("trainer_id","item_id"),
	CONSTRAINT "bag_qty_check" CHECK ("bag"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "brain_usage" (
	"pokemon_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tick_calls" integer DEFAULT 0 NOT NULL,
	"talk_calls" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brain_usage_pokemon_id_day_pk" PRIMARY KEY("pokemon_id","day")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pokemon_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"importance" integer NOT NULL,
	"trainer_id" uuid,
	"emotion" text,
	"rolled_up" boolean DEFAULT false NOT NULL,
	CONSTRAINT "event_importance_check" CHECK ("event"."importance" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trainer_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pokemon" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trainer_id" uuid NOT NULL,
	"identity" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"personality" jsonb NOT NULL,
	"memories" jsonb NOT NULL,
	"pokedex" jsonb NOT NULL,
	"inventory" jsonb NOT NULL,
	"history" jsonb NOT NULL,
	"slot" integer,
	"active" boolean DEFAULT false NOT NULL,
	"box" integer,
	"box_slot" integer,
	"status" text DEFAULT 'home' NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pokemon_status_check" CHECK ("pokemon"."status" in ('home', 'pc', 'in_transit', 'released')),
	CONSTRAINT "pokemon_slot_check" CHECK ("pokemon"."slot" is null or ("pokemon"."slot" between 1 and 6)),
	CONSTRAINT "pokemon_box_slot_check" CHECK ("pokemon"."box_slot" is null or ("pokemon"."box_slot" between 1 and 30))
);
--> statement-breakpoint
CREATE TABLE "trade" (
	"nonce" text PRIMARY KEY NOT NULL,
	"pokemon_id" uuid NOT NULL,
	"from_trainer_id" uuid NOT NULL,
	"to_trainer_id" uuid,
	"state" text DEFAULT 'offered' NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trade_state_check" CHECK ("trade"."state" in ('offered', 'cancelled', 'confirmed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "trainer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "bag" ADD CONSTRAINT "bag_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_usage" ADD CONSTRAINT "brain_usage_pokemon_id_pokemon_id_fk" FOREIGN KEY ("pokemon_id") REFERENCES "public"."pokemon"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_pokemon_id_pokemon_id_fk" FOREIGN KEY ("pokemon_id") REFERENCES "public"."pokemon"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pokemon" ADD CONSTRAINT "pokemon_trainer_id_trainer_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade" ADD CONSTRAINT "trade_pokemon_id_pokemon_id_fk" FOREIGN KEY ("pokemon_id") REFERENCES "public"."pokemon"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade" ADD CONSTRAINT "trade_from_trainer_id_trainer_id_fk" FOREIGN KEY ("from_trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade" ADD CONSTRAINT "trade_to_trainer_id_trainer_id_fk" FOREIGN KEY ("to_trainer_id") REFERENCES "public"."trainer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_pokemon_ts_idx" ON "event" USING btree ("pokemon_id","ts");--> statement-breakpoint
CREATE INDEX "event_pending_idx" ON "event" USING btree ("pokemon_id") WHERE not "event"."rolled_up";--> statement-breakpoint
CREATE INDEX "ledger_trainer_at_idx" ON "ledger" USING btree ("trainer_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_stipend_day_idx" ON "ledger" USING btree ("trainer_id","ref") WHERE "ledger"."reason" = 'stipend';--> statement-breakpoint
CREATE UNIQUE INDEX "pokemon_trainer_slot_idx" ON "pokemon" USING btree ("trainer_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "pokemon_trainer_box_slot_idx" ON "pokemon" USING btree ("trainer_id","box","box_slot");--> statement-breakpoint
CREATE UNIQUE INDEX "pokemon_trainer_active_idx" ON "pokemon" USING btree ("trainer_id") WHERE "pokemon"."active";--> statement-breakpoint
CREATE INDEX "pokemon_trainer_status_idx" ON "pokemon" USING btree ("trainer_id","status");--> statement-breakpoint
CREATE INDEX "trade_pokemon_state_idx" ON "trade" USING btree ("pokemon_id","state");